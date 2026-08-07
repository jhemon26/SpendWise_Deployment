import Dexie, { type Table as DexieTable } from 'dexie';
import type { Bank, Category, Transaction } from '@spendwise/shared-types';
import type { Row, StorageAdapter, Table } from './adapter.js';

/**
 * IndexedDB adapter for the web target (ARCHITECTURE §4.2).
 *
 * Indexes are chosen for the two queries that actually run: "everything for a
 * screen" and "what still needs uploading". `sync_status` is indexed because
 * the sync engine asks for pending rows on every wake — a full scan there would
 * grow linearly with a user's entire history.
 *
 * IndexedDB cannot be transparently encrypted, so on web the sensitive FIELDS
 * are encrypted rather than the store (§4.3). That is a real asymmetry with
 * native SQLCipher, and it is documented rather than hidden.
 */

class SpendWiseDb extends Dexie {
  transactions!: DexieTable<Transaction, string>;
  categories!: DexieTable<Category, string>;
  banks!: DexieTable<Bank, string>;

  constructor(name = 'spendwise') {
    super(name);
    this.version(1).stores({
      transactions: 'local_id, sync_status, occurred_at, updated_at, category_id',
      categories: 'local_id, sync_status, updated_at',
      banks: 'local_id, sync_status, updated_at',
    });
  }
}

export class DexieAdapter implements StorageAdapter {
  private readonly db: SpendWiseDb;

  constructor(name?: string) {
    this.db = new SpendWiseDb(name);
  }

  async init(): Promise<void> {
    await this.db.open();
  }

  private table(t: Table): DexieTable<Transaction | Category | Bank, string> {
    return this.db[t] as unknown as DexieTable<Transaction | Category | Bank, string>;
  }

  async all<T extends Table>(table: T): Promise<Row[T][]> {
    return (await this.table(table).toArray()) as Row[T][];
  }

  async get<T extends Table>(table: T, localId: string): Promise<Row[T] | null> {
    return ((await this.table(table).get(localId)) as Row[T]) ?? null;
  }

  async put<T extends Table>(table: T, rec: Row[T]): Promise<Row[T]> {
    await this.table(table).put(rec);
    return rec;
  }

  async bulkPut<T extends Table>(table: T, recs: Row[T][]): Promise<void> {
    if (recs.length === 0) return;
    await this.table(table).bulkPut(recs);
  }

  /**
   * Tombstone, never a hard delete. A row removed from IndexedDB is invisible
   * to sync, so the other device never learns it is gone and resurrects it.
   */
  async softDelete<T extends Table>(table: T, localId: string, at: string): Promise<void> {
    const cur = await this.table(table).get(localId);
    if (!cur) return;
    await this.table(table).put({
      ...cur,
      deleted_at: at,
      updated_at: at,
      sync_status: 'pending',
    });
  }

  /**
   * Categories and banks are returned ahead of transactions.
   *
   * A transaction referencing a brand-new category must not reach the server
   * before the category does, or the server stores a dangling reference.
   */
  async pending(): Promise<Array<{ table: Table; rec: Transaction | Category | Bank }>> {
    const out: Array<{ table: Table; rec: Transaction | Category | Bank }> = [];
    for (const table of ['categories', 'banks', 'transactions'] as Table[]) {
      const rows = await this.table(table)
        .where('sync_status')
        .anyOf('pending', 'failed')
        .toArray();
      for (const rec of rows) out.push({ table, rec });
    }
    return out.sort((a, b) => a.rec.updated_at.localeCompare(b.rec.updated_at));
  }

  async markSynced(table: Table, localId: string, version: number): Promise<void> {
    const cur = await this.table(table).get(localId);
    if (!cur) return;
    await this.table(table).put({ ...cur, sync_status: 'synced', version });
  }

  async markFailed(table: Table, localId: string): Promise<void> {
    const cur = await this.table(table).get(localId);
    if (!cur) return;
    await this.table(table).put({ ...cur, sync_status: 'failed' });
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.transactions, this.db.categories, this.db.banks, async () => {
      await Promise.all([
        this.db.transactions.clear(),
        this.db.categories.clear(),
        this.db.banks.clear(),
      ]);
    });
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/**
 * Pick the right engine for the platform.
 *
 * Native gets SQLite via Capacitor (still to be written); web gets Dexie. No
 * feature code should ever call this more than once — the app holds a single
 * adapter for its lifetime.
 */
export function createWebAdapter(name?: string): StorageAdapter {
  return new DexieAdapter(name);
}
