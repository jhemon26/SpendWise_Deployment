// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { App } from './App.js';

/**
 * Does the app render at all?
 *
 * This exists because it once did not, twice, and nothing caught it. A `const`
 * declared below a useMemo that reads it is legal TypeScript — the reference
 * sits inside a closure, so the compiler has no reason to object — but React
 * runs that callback during the same render pass, while the binding is still
 * in its temporal dead zone. The whole tree threw, #root stayed empty, and the
 * bundle was served, cached and verified as "deployed" while showing a blank
 * screen to everyone who opened it.
 *
 * Unit tests all passed throughout. They test the engines, which are pure and
 * were fine. Nothing mounted a component, so nothing noticed.
 */

/* jsdom's storage is unusable under this runner's node flags, so stand in a
   real one. The app only ever reads and writes string keys. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  } as Storage;
}
for (const k of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, k, { value: memoryStorage(), configurable: true, writable: true });
}
globalThis.matchMedia ??= ((q: string) => ({
  matches: false, media: q, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent: () => false,
})) as typeof globalThis.matchMedia;
globalThis.scrollTo ??= (() => {}) as typeof globalThis.scrollTo;
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline in test'))));

afterEach(cleanup);

describe('App renders', () => {
  it('mounts without throwing and puts something on screen', () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a[0]); });

    const { container } = render(<App />);

    spy.mockRestore();
    // A render-time throw leaves the container empty and logs to console.error.
    expect(errors, `App logged during render:\n${errors.map(String).join('\n')}`).toEqual([]);
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  /*
   * The render above only catches a forward reference on the path a cold start
   * happens to take. This catches every one in the file, including in branches
   * a test would need real data to reach.
   */
  it('never reads a memoised value declared further down the component', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');

    // Where each `const x = useMemo(` / `useCallback(` binding is introduced.
    const declared = new Map<string, number>();
    for (const m of src.matchAll(/\bconst (\w+) = use(?:Memo|Callback)\(/g)) {
      declared.set(m[1]!, m.index!);
    }
    expect(declared.size, 'expected to find memo bindings to check').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const m of src.matchAll(/\bconst (\w+) = use(?:Memo|Callback)\(/g)) {
      const owner = m[1]!;
      // The callback body: from this declaration to the start of the next one.
      const nextAt = [...declared.values()].filter((i) => i > m.index!).sort((a, b) => a - b)[0] ?? src.length;
      const body = src.slice(m.index!, nextAt);
      for (const [name, at] of declared) {
        if (name === owner || at < m.index!) continue;
        if (new RegExp(`\\b${name}\\.`).test(body)) {
          offenders.push(`${owner} reads ${name}, which is declared below it`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
