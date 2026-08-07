import { describe, it, expect, vi, afterEach } from 'vitest';
import { openLocalStore } from './index.js';
import { MemoryAdapter, type StorageAdapter } from './adapter.js';

/**
 * The failure this guards against is a permanent "Loading…" with an empty
 * console — the worst outcome available, because it looks like a broken app
 * and gives nobody anything to debug.
 */

const original = globalThis.indexedDB;
afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(globalThis, 'indexedDB');
  else Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true });
  vi.useRealTimers();
});

function withIndexedDb(present: boolean): void {
  if (present) {
    Object.defineProperty(globalThis, 'indexedDB', { value: {}, configurable: true });
  } else {
    Reflect.deleteProperty(globalThis, 'indexedDB');
  }
}

const stub = (init: () => Promise<void>): StorageAdapter =>
  ({ ...new MemoryAdapter(), init } as unknown as StorageAdapter);

describe('openLocalStore', () => {
  it('uses the real adapter when it opens cleanly', async () => {
    withIndexedDb(true);
    const res = await openLocalStore(1000, () => stub(async () => undefined));
    expect(res.degraded).toBe(false);
    expect(res.reason).toBeUndefined();
  });

  it('falls back when IndexedDB is absent entirely', async () => {
    withIndexedDb(false);
    const res = await openLocalStore();
    expect(res.degraded).toBe(true);
    expect(res.reason).toMatch(/unavailable/i);
    expect(res.adapter).toBeInstanceOf(MemoryAdapter);
  });

  it('falls back when open REJECTS — Safari private mode', async () => {
    withIndexedDb(true);
    const res = await openLocalStore(1000, () =>
      stub(async () => { throw new Error('QuotaExceededError'); }),
    );
    expect(res.degraded).toBe(true);
    expect(res.reason).toMatch(/Quota/);
    expect(res.adapter).toBeInstanceOf(MemoryAdapter);
  });

  it('falls back when open NEVER SETTLES — the hang case', async () => {
    // This is the one that produced a permanent "Loading…" screen.
    withIndexedDb(true);
    const res = await openLocalStore(50, () => stub(() => new Promise<void>(() => undefined)));
    expect(res.degraded).toBe(true);
    expect(res.reason).toMatch(/timed out/i);
    expect(res.adapter).toBeInstanceOf(MemoryAdapter);
  });

  it('the fallback adapter is actually usable, not a stub', async () => {
    withIndexedDb(true);
    const { adapter } = await openLocalStore(20, () => stub(() => new Promise<void>(() => undefined)));
    await adapter.init();
    expect(await adapter.all('transactions')).toEqual([]);
  });

  it('does not leave a timer running after a successful open', async () => {
    vi.useFakeTimers();
    withIndexedDb(true);
    await openLocalStore(5000, () => stub(async () => undefined));
    expect(vi.getTimerCount()).toBe(0); // otherwise the process hangs on exit
  });
});
