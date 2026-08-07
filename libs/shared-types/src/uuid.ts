/**
 * UUIDv7 — time-ordered, client-generated primary keys.
 *
 * Why not v4: a random primary key lands in a random B-tree leaf on every
 * insert, so the index working set is the whole index. UUIDv7 puts a
 * millisecond timestamp in the high 48 bits, so inserts append like a
 * sequence while staying collision-free across offline devices that have
 * never spoken to the server or to each other.
 *
 * Layout (RFC 9562):
 *   48 bits  unix_ts_ms
 *    4 bits  version (0111)
 *   12 bits  counter   — monotonic within the same millisecond
 *    2 bits  variant (10)
 *   62 bits  random
 */

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

let lastMs = -1;
let counter = 0;

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/**
 * Generate a UUIDv7.
 *
 * `now` is injectable so tests can pin the clock. The 12-bit counter
 * guarantees ordering for IDs minted in the same millisecond — without it,
 * a fast loop produces IDs that sort randomly inside that millisecond and the
 * "time-ordered" property quietly stops holding exactly when it matters
 * (bulk import, replaying a sync queue).
 */
export function uuidv7(now: number = Date.now()): string {
  if (now === lastMs) {
    counter = (counter + 1) & 0xfff;
    // 4096 IDs in one millisecond: step into the next to preserve ordering
    if (counter === 0) now = ++lastMs;
  } else if (now > lastMs) {
    lastMs = now;
    counter = randomBytes(2)[0]! & 0x0ff; // start low, leave room to climb
  } else {
    // clock moved backwards (NTP correction, user changed the date):
    // keep issuing from the last known millisecond so IDs stay monotonic
    now = lastMs;
    counter = (counter + 1) & 0xfff;
  }

  const ts = BigInt(now);
  const bytes = new Uint8Array(16);

  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // version 7 + top 4 bits of the counter
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  const rand = randomBytes(8);
  // variant 10xxxxxx
  bytes[8] = (rand[0]! & 0x3f) | 0x80;
  for (let i = 1; i < 8; i++) bytes[8 + i] = rand[i]!;

  const h = (i: number) => HEX[bytes[i]!]!;
  return (
    h(0) + h(1) + h(2) + h(3) + '-' +
    h(4) + h(5) + '-' +
    h(6) + h(7) + '-' +
    h(8) + h(9) + '-' +
    h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}

/** Extract the embedded timestamp. Useful for debugging and for sync ordering. */
export function uuidv7Time(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return Number(BigInt('0x' + hex));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidv7(v: string): boolean {
  return UUID_RE.test(v);
}

/** Test hook — resets the monotonic counter so cases can't leak into each other. */
export function __resetUuidClock(): void {
  lastMs = -1;
  counter = 0;
}
