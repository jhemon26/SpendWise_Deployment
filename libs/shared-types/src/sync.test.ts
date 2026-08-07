import { describe, it, expect } from 'vitest';
import {
  syncEnvelopeSchema,
  transactionSchema,
  syncPushRequestSchema,
  resolveLww,
  resolveTombstone,
  MAX_PUSH_BATCH,
} from './sync.js';
import { uuidv7 } from './uuid.js';

const iso = (s: string) => new Date(s).toISOString();

function envelope(over: Record<string, unknown> = {}) {
  return {
    local_id: uuidv7(),
    server_id: null,
    created_at: iso('2026-08-07T09:00:00Z'),
    updated_at: iso('2026-08-07T09:00:00Z'),
    deleted_at: null,
    sync_status: 'pending',
    version: 0,
    device_id: 'device-abc',
    ...over,
  };
}

describe('syncEnvelopeSchema', () => {
  it('accepts a well-formed envelope', () => {
    expect(syncEnvelopeSchema.safeParse(envelope()).success).toBe(true);
  });

  it('rejects a non-UUID local_id', () => {
    expect(syncEnvelopeSchema.safeParse(envelope({ local_id: 'nope' })).success).toBe(false);
  });

  it('rejects a negative version', () => {
    expect(syncEnvelopeSchema.safeParse(envelope({ version: -1 })).success).toBe(false);
  });

  it('rejects an unknown sync_status', () => {
    expect(syncEnvelopeSchema.safeParse(envelope({ sync_status: 'maybe' })).success).toBe(false);
  });

  it('strips unknown keys rather than passing them through', () => {
    const parsed = syncEnvelopeSchema.parse(envelope({ injected: 'evil' }));
    expect(parsed).not.toHaveProperty('injected');
  });
});

describe('transactionSchema', () => {
  const tx = (over: Record<string, unknown> = {}) => ({
    ...envelope(),
    category_id: null,
    bank_id: null,
    amount_minor: -1550,
    currency: 'GBP',
    base_minor: -1550,
    base_currency: 'GBP',
    fx_rate: 1,
    fx_rate_date: '2026-08-07',
    fx_provisional: false,
    merchant: "Sainsbury's Local",
    note: null,
    occurred_at: iso('2026-08-07T09:15:00Z'),
    is_income: false,
    pending: false,
    ...over,
  });

  it('accepts a valid transaction', () => {
    const r = transactionSchema.safeParse(tx());
    expect(r.success).toBe(true);
  });

  it('requires integer minor units — no floats on the wire', () => {
    expect(transactionSchema.safeParse(tx({ amount_minor: 15.5 })).success).toBe(false);
  });

  it('rejects a malformed currency code', () => {
    expect(transactionSchema.safeParse(tx({ currency: 'gbp' })).success).toBe(false);
    expect(transactionSchema.safeParse(tx({ currency: 'POUND' })).success).toBe(false);
  });

  it('allows a null base_minor for an offline entry with no cached rate', () => {
    expect(transactionSchema.safeParse(tx({ base_minor: null, fx_provisional: true })).success).toBe(true);
  });

  it('rejects a non-positive fx_rate', () => {
    expect(transactionSchema.safeParse(tx({ fx_rate: 0 })).success).toBe(false);
  });
});

describe('syncPushRequestSchema', () => {
  it('caps the batch size', () => {
    const big = Array.from({ length: MAX_PUSH_BATCH + 1 }, () => ({
      ...envelope(),
      name: 'Groceries',
      icon: 'groceries',
      colour: '#14B8A6',
      limit_minor: 32000,
      is_fixed: false,
    }));
    const r = syncPushRequestSchema.safeParse({
      device_id: 'd1',
      idempotency_key: uuidv7(),
      client_time: iso('2026-08-07T09:00:00Z'),
      categories: big,
    });
    expect(r.success).toBe(false);
  });

  it('defaults empty collections', () => {
    const r = syncPushRequestSchema.parse({
      device_id: 'd1',
      idempotency_key: uuidv7(),
      client_time: iso('2026-08-07T09:00:00Z'),
    });
    expect(r.transactions).toEqual([]);
    expect(r.categories).toEqual([]);
    expect(r.banks).toEqual([]);
  });
});

describe('resolveLww', () => {
  it('takes the newer record', () => {
    const local = { updated_at: iso('2026-08-07T10:00:00Z') };
    const remote = { updated_at: iso('2026-08-07T11:00:00Z') };
    expect(resolveLww(local, remote)).toBe(remote);
    expect(resolveLww(remote, local)).toBe(remote);
  });

  it('breaks exact ties in favour of the server', () => {
    const t = iso('2026-08-07T10:00:00Z');
    const local = { updated_at: t };
    const remote = { updated_at: t };
    expect(resolveLww(local, remote)).toBe(remote);
  });

  it('survives an unparseable timestamp', () => {
    const local = { updated_at: 'garbage' };
    const remote = { updated_at: iso('2026-08-07T10:00:00Z') };
    expect(resolveLww(local, remote)).toBe(remote);
    expect(resolveLww(remote, local)).toBe(remote);
  });
});

describe('resolveTombstone', () => {
  it('lets a deletion win over a newer edit', () => {
    // Deletion is deliberate; a resurrected transaction alarms users more
    // than a lost edit.
    const deleted = {
      updated_at: iso('2026-08-07T10:00:00Z'),
      deleted_at: iso('2026-08-07T10:00:00Z'),
    };
    const edited = { updated_at: iso('2026-08-07T11:00:00Z'), deleted_at: null };
    expect(resolveTombstone(deleted, edited)).toBe(deleted);
    expect(resolveTombstone(edited, deleted)).toBe(deleted);
  });

  it('falls back to LWW when neither side is deleted', () => {
    const a = { updated_at: iso('2026-08-07T10:00:00Z'), deleted_at: null };
    const b = { updated_at: iso('2026-08-07T11:00:00Z'), deleted_at: null };
    expect(resolveTombstone(a, b)).toBe(b);
  });

  it('falls back to LWW when both are deleted', () => {
    const a = {
      updated_at: iso('2026-08-07T10:00:00Z'),
      deleted_at: iso('2026-08-07T10:00:00Z'),
    };
    const b = {
      updated_at: iso('2026-08-07T11:00:00Z'),
      deleted_at: iso('2026-08-07T11:00:00Z'),
    };
    expect(resolveTombstone(a, b)).toBe(b);
  });
});
