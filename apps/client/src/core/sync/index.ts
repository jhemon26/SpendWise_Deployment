import type { StorageAdapter } from '../db/adapter.js';
import { SyncEngine } from './engine.js';
import { HttpSyncTransport, MemoryTokenStore, type TokenStore } from './transport.http.js';

/**
 * Wire the sync engine to the API.
 *
 * Returns null when there is no API configured or nobody signed in. The engine
 * is deliberately NOT started in that case: a background loop that 401s every
 * sixty seconds burns battery, fills logs, and teaches the user to ignore the
 * error state. Offline-first means the app is fully usable without it.
 */
export interface SyncSetup {
  engine: SyncEngine;
  transport: HttpSyncTransport;
  tokens: TokenStore;
}

export const tokenStore: TokenStore = new MemoryTokenStore();

export function createSync(
  db: StorageAdapter,
  deviceId: string,
  baseUrl: string | undefined,
  onAuthLost?: () => void,
  /** Fired after pulled rows are written, so the caller can reload the store. */
  onPulled?: () => void,
): SyncSetup | null {
  if (!baseUrl) return null;
  if (!tokenStore.getAccessToken()) return null;

  const transport = new HttpSyncTransport({
    baseUrl,
    deviceId,
    tokens: tokenStore,
    ...(onAuthLost ? { onAuthLost } : {}),
  });
  return {
    engine: new SyncEngine(db, transport, deviceId, onPulled ? { onPulled } : {}),
    transport,
    tokens: tokenStore,
  };
}

export { SyncEngine } from './engine.js';
export { HttpSyncTransport, MemoryTokenStore, TransportError } from './transport.http.js';
export type { SyncTransport, SyncState } from './engine.js';
export type { TokenStore } from './transport.http.js';
