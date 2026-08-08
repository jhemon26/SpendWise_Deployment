import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

/**
 * Settings used to live in memory only, so the name and budget collected during
 * onboarding were gone on the next reload and every Profile edit was silently
 * discarded. These pin the persistence down.
 *
 * The store reads storage at module-evaluation time, so a working Storage has
 * to exist BEFORE the import — hence the dynamic import in beforeAll. The jsdom
 * environment here exposes `localStorage` as a bare object with none of the
 * Storage methods, so it cannot be used as-is.
 */

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
}

const KEY = 'sw.settings';
const store = new MemoryStorage();

type StoreModule = typeof import('./store.js');
let mod: StoreModule;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  mod = await import('./store.js');
});

const read = (): Record<string, unknown> => JSON.parse(store.getItem(KEY) ?? '{}');

beforeEach(() => {
  store.clear();
  mod.useApp.setState({
    dayToDayMinor: 82000, savingsTargetMinor: 40800,
    displayName: 'Jahid', baseCurrency: 'GBP',
  });
});

describe('settings persistence', () => {
  it('writes a changed budget to storage', () => {
    mod.useApp.getState().setSettings({ dayToDayMinor: 55000 });
    expect(read()['dayToDayMinor']).toBe(55000);
  });

  it('keeps the fields it was not asked to change', () => {
    mod.useApp.getState().setSettings({ displayName: 'Sam' });
    expect(read()).toMatchObject({
      displayName: 'Sam', dayToDayMinor: 82000, savingsTargetMinor: 40800, baseCurrency: 'GBP',
    });
  });

  it('updates the live state as well as storage', () => {
    mod.useApp.getState().setSettings({ savingsTargetMinor: 12345 });
    expect(mod.useApp.getState().savingsTargetMinor).toBe(12345);
  });

  it('clearSettings wipes the blob, so the next account starts clean', () => {
    mod.useApp.getState().setSettings({ displayName: 'Sam' });
    mod.clearSettings();
    expect(store.getItem(KEY)).toBeNull();
  });

  it('survives a rename containing quotes and unicode', () => {
    mod.useApp.getState().setSettings({ displayName: 'Ann "AJ" Ó’Néill' });
    expect(read()['displayName']).toBe('Ann "AJ" Ó’Néill');
  });

  it('does not throw when storage is unavailable', () => {
    // Private browsing and full quotas both make setItem throw. The in-memory
    // update must still happen — losing a preference is not worth a crash.
    const broken = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => { throw new Error('nope'); } };
    Object.defineProperty(globalThis, 'localStorage', { value: broken, configurable: true, writable: true });
    expect(() => mod.useApp.getState().setSettings({ displayName: 'Kai' })).not.toThrow();
    expect(mod.useApp.getState().displayName).toBe('Kai');
    expect(() => mod.clearSettings()).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  });
});

describe('avatar', () => {
  it('persists the chosen emoji and colour', () => {
    mod.useApp.getState().setSettings({ avatarEmoji: '🦊', avatarColour: '#14B8A6' });
    expect(read()).toMatchObject({ avatarEmoji: '🦊', avatarColour: '#14B8A6' });
  });

  it('discards a colour that is not a hex triplet on load', async () => {
    // The value goes straight into an inline style, so junk must not survive.
    // Settings are read at module-evaluation time, so this has to reset the
    // module registry and import again — asserting on what we just wrote would
    // pass whether or not the validation exists.
    store.setItem(KEY, JSON.stringify({ avatarColour: 'red; background:url(javascript:1)' }));
    vi.resetModules();
    const reloaded = await import('./store.js') as StoreModule;
    expect(reloaded.useApp.getState().avatarColour).toBe('#6366F1');
  });

  it('keeps a valid colour across a reload', async () => {
    store.setItem(KEY, JSON.stringify({ avatarColour: '#14B8A6', avatarEmoji: '🐼' }));
    vi.resetModules();
    const reloaded = await import('./store.js') as StoreModule;
    expect(reloaded.useApp.getState().avatarColour).toBe('#14B8A6');
    expect(reloaded.useApp.getState().avatarEmoji).toBe('🐼');
  });
});
