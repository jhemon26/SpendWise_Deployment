import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { uuidv7, flowFields, type Category, type Transaction } from '@spendwise/shared-types';
import { MemoryAdapter, type StorageAdapter } from './adapter.js';
import { DexieAdapter } from './dexie.js';

/**
 * ONE contract, run against BOTH adapters.
 *
 * The point of the StorageAdapter interface is that feature code cannot tell
 * which engine is underneath. A shared suite is the only way to know that is
 * actually true — two separate test files drift, and the Dexie one would be
 * the one nobody notices is weaker.
 */

const NOW = '2026-08-07T12:00:00.000Z';

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    local_id: uuidv7(), server_id: null, created_at: NOW, updated_at: NOW, deleted_at: null,
    sync_status: 'pending', version: 0, device_id: 'd1',
    category_id: null, bank_id: null,
    amount_minor: -1000, currency: 'GBP', base_minor: -1000, base_currency: 'GBP',
    fx_rate: 1, fx_rate_date: '2026-08-07', fx_provisional: false,
    merchant: 'Shop', note: null, occurred_at: NOW, is_income: false, is_transfer: false, pending: false, ...over,
  };
}

function cat(over: Partial<Category> = {}): Category {
  return {
    local_id: uuidv7(), server_id: null, created_at: NOW, updated_at: NOW, deleted_at: null,
    sync_status: 'pending', version: 0, device_id: 'd1',
    name: 'Groceries', icon: 'groceries', colour: '#14B8A6', limit_minor: 32000,
    is_fixed: false, due_day: null, ...flowFields(), ...over,
  };
}

const engines: Array<[string, () => StorageAdapter]> = [
  ['MemoryAdapter', () => new MemoryAdapter()],
  ['DexieAdapter', () => new DexieAdapter(`test-${Math.random().toString(36).slice(2)}`)],
];

describe.each(engines)('StorageAdapter contract — %s', (_name, make) => {
  let db: StorageAdapter;

  beforeEach(async () => {
    db = make();
    await db.init();
  });
  afterEach(async () => {
    await db.clear();
  });

  it('round-trips a record', async () => {
    const t = tx();
    await db.put('transactions', t);
    expect(await db.get('transactions', t.local_id)).toMatchObject({
      local_id: t.local_id,
      amount_minor: -1000,
    });
  });

  it('returns null for a missing record rather than throwing', async () => {
    expect(await db.get('transactions', uuidv7())).toBeNull();
  });

  it('overwrites on put with the same id', async () => {
    const t = tx();
    await db.put('transactions', t);
    await db.put('transactions', { ...t, merchant: 'Changed' });
    expect((await db.all('transactions'))).toHaveLength(1);
    expect((await db.get('transactions', t.local_id))?.merchant).toBe('Changed');
  });

  it('bulkPut writes many and tolerates an empty array', async () => {
    await db.bulkPut('transactions', [tx(), tx(), tx()]);
    await db.bulkPut('transactions', []);
    expect(await db.all('transactions')).toHaveLength(3);
  });

  it('keeps tables separate', async () => {
    await db.put('transactions', tx());
    await db.put('categories', cat());
    expect(await db.all('transactions')).toHaveLength(1);
    expect(await db.all('categories')).toHaveLength(1);
  });

  describe('soft delete', () => {
    it('tombstones rather than removing', async () => {
      // A hard delete is invisible to sync: the other device never learns the
      // row is gone and resurrects it.
      const t = tx({ sync_status: 'synced' });
      await db.put('transactions', t);
      await db.softDelete('transactions', t.local_id, NOW);

      const after = await db.get('transactions', t.local_id);
      expect(after).not.toBeNull();
      expect(after?.deleted_at).toBe(NOW);
      expect(after?.sync_status).toBe('pending'); // must be re-uploaded
    });

    it('is a no-op on a missing row', async () => {
      await expect(db.softDelete('transactions', uuidv7(), NOW)).resolves.toBeUndefined();
    });
  });

  describe('pending()', () => {
    it('returns pending and failed, but not synced', async () => {
      await db.put('transactions', tx({ sync_status: 'pending' }));
      await db.put('transactions', tx({ sync_status: 'failed' }));
      await db.put('transactions', tx({ sync_status: 'synced' }));
      expect(await db.pending()).toHaveLength(2);
    });

    it('orders categories before transactions', async () => {
      // A transaction referencing a brand-new category must not be uploaded
      // before the category itself.
      await db.put('transactions', tx());
      await db.put('categories', cat());
      const order = (await db.pending()).map((p) => p.table);
      expect(order.indexOf('categories')).toBeLessThan(order.indexOf('transactions'));
    });

    it('is empty when everything is synced', async () => {
      await db.put('transactions', tx({ sync_status: 'synced' }));
      expect(await db.pending()).toEqual([]);
    });
  });

  describe('sync bookkeeping', () => {
    it('markSynced clears the queue and records the server version', async () => {
      const t = tx();
      await db.put('transactions', t);
      await db.markSynced('transactions', t.local_id, 7);
      const after = await db.get('transactions', t.local_id);
      expect(after?.sync_status).toBe('synced');
      expect(after?.version).toBe(7);
      expect(await db.pending()).toEqual([]);
    });

    it('markFailed keeps the record queued for retry', async () => {
      const t = tx({ sync_status: 'synced' });
      await db.put('transactions', t);
      await db.markFailed('transactions', t.local_id);
      expect((await db.pending()).map((p) => p.rec.local_id)).toEqual([t.local_id]);
    });

    it('marking a missing row does not throw', async () => {
      await expect(db.markSynced('transactions', uuidv7(), 1)).resolves.toBeUndefined();
      await expect(db.markFailed('transactions', uuidv7())).resolves.toBeUndefined();
    });
  });

  it('clear empties every table', async () => {
    await db.put('transactions', tx());
    await db.put('categories', cat());
    await db.clear();
    expect(await db.all('transactions')).toEqual([]);
    expect(await db.all('categories')).toEqual([]);
  });
});

describe('DexieAdapter persistence', () => {
  it('survives a reopen — the whole point over MemoryAdapter', async () => {
    const name = `persist-${Math.random().toString(36).slice(2)}`;
    const first = new DexieAdapter(name);
    await first.init();
    const t = tx();
    await first.put('transactions', t);
    await first.close();

    const second = new DexieAdapter(name);
    await second.init();
    expect(await second.get('transactions', t.local_id)).toMatchObject({ local_id: t.local_id });
    await second.clear();
    await second.close();
  });
});
