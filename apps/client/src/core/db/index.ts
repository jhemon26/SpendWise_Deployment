import { MemoryAdapter, type StorageAdapter } from './adapter.js';
import { DexieAdapter } from './dexie.js';

/**
 * Choose a local store, and never hang.
 *
 * `typeof indexedDB !== 'undefined'` is NOT enough. Safari in private mode,
 * storage-blocked embeds and denied quota all expose the API and then fail to
 * open — sometimes by rejecting, sometimes by never settling at all. An app
 * that awaits that forever shows a permanent "Loading…" with nothing in the
 * console, which is the single worst failure mode available.
 *
 * So: race the open against a timeout and fall back to memory. The user gets a
 * working session that does not survive a refresh, which is far better than a
 * dead screen — and `degraded` lets the UI say so honestly.
 */
export interface OpenResult {
  adapter: StorageAdapter;
  degraded: boolean;
  reason?: string;
}

export const OPEN_TIMEOUT_MS = 3000;

export async function openLocalStore(
  timeoutMs = OPEN_TIMEOUT_MS,
  factory: () => StorageAdapter = () => new DexieAdapter(),
): Promise<OpenResult> {
  if (typeof indexedDB === 'undefined') {
    return { adapter: new MemoryAdapter(), degraded: true, reason: 'IndexedDB unavailable' };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const adapter = factory();
    await Promise.race([
      adapter.init(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out opening IndexedDB')), timeoutMs);
      }),
    ]);
    return { adapter, degraded: false };
  } catch (err) {
    return {
      adapter: new MemoryAdapter(),
      degraded: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
