/**
 * The sync protocol. Client and server both import these schemas, so the
 * wire format cannot drift between them — that is the entire reason this
 * package exists.
 */
import { z } from 'zod';

export const SYNC_STATUS = ['pending', 'synced', 'failed', 'conflict'] as const;
export const syncStatusSchema = z.enum(SYNC_STATUS);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

/** Columns every syncable record carries on every platform. */
export const syncEnvelopeSchema = z.object({
  local_id: uuid,
  server_id: uuid.nullable().default(null),
  created_at: isoDate,
  updated_at: isoDate,
  deleted_at: isoDate.nullable().default(null),
  sync_status: syncStatusSchema.default('pending'),
  version: z.number().int().nonnegative().default(0),
  device_id: z.string().min(1).max(128),
});
export type SyncEnvelope = z.infer<typeof syncEnvelopeSchema>;

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO-4217 code');

/**
 * A transaction on the wire.
 *
 * `amount_minor` + `currency` is what the user actually spent and is
 * client-authoritative. `base_minor` / `fx_rate` are the reporting-currency
 * view; the client may compute them provisionally while offline, but the
 * server recomputes them from authoritative ECB rates and wins.
 */
export const transactionSchema = syncEnvelopeSchema.extend({
  category_id: uuid.nullable(),
  bank_id: uuid.nullable(),

  amount_minor: z.number().int(),
  currency: currencyCodeSchema,

  base_minor: z.number().int().nullable(),
  base_currency: currencyCodeSchema,
  fx_rate: z.number().positive(),
  fx_rate_date: z.string().date(),
  fx_provisional: z.boolean().default(false),

  merchant: z.string().max(200).nullable(),
  note: z.string().max(2000).nullable(),
  occurred_at: isoDate,
  is_income: z.boolean().default(false),
  pending: z.boolean().default(false),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const categorySchema = syncEnvelopeSchema.extend({
  name: z.string().min(1).max(48),
  icon: z.string().min(1).max(32),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  limit_minor: z.number().int().nonnegative(),
  is_fixed: z.boolean().default(false),
});
export type Category = z.infer<typeof categorySchema>;

export const bankSchema = syncEnvelopeSchema.extend({
  name: z.string().min(1).max(48),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Bank = z.infer<typeof bankSchema>;

/* ── push ────────────────────────────────────────────────────────────── */

export const MAX_PUSH_BATCH = 100;

export const syncPushRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  /** Replaying this key must not apply the batch twice. See ARCHITECTURE §6.5. */
  idempotency_key: uuid,
  client_time: isoDate,
  transactions: z.array(transactionSchema).max(MAX_PUSH_BATCH).default([]),
  categories: z.array(categorySchema).max(MAX_PUSH_BATCH).default([]),
  banks: z.array(bankSchema).max(MAX_PUSH_BATCH).default([]),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export const syncConflictSchema = z.object({
  local_id: uuid,
  entity: z.enum(['transaction', 'category', 'bank']),
  reason: z.enum(['version_behind', 'amount_mismatch']),
  server_version: z.number().int(),
  /** The server's copy, so the client can show both sides without a refetch. */
  server_record: z.unknown(),
});
export type SyncConflict = z.infer<typeof syncConflictSchema>;

export const syncPushResponseSchema = z.object({
  accepted: z.array(z.object({ local_id: uuid, version: z.number().int() })),
  conflicts: z.array(syncConflictSchema),
  server_time: isoDate,
  /** Set when the idempotency key was already applied; body is the first result. */
  replayed: z.boolean().default(false),
});
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

/* ── pull ────────────────────────────────────────────────────────────── */

export const PULL_PAGE_SIZE = 500;

export const syncPullQuerySchema = z.object({
  device_id: z.string().min(1).max(128),
  since: isoDate.optional(),
  cursor: z.string().max(512).optional(),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export const syncPullResponseSchema = z.object({
  transactions: z.array(transactionSchema),
  categories: z.array(categorySchema),
  banks: z.array(bankSchema),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
  server_time: isoDate,
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

/* ── conflict resolution ─────────────────────────────────────────────── */

/**
 * Last-Write-Wins on `updated_at`, with the server breaking exact ties.
 *
 * Device clocks lie, so this is only safe because the server normalises
 * timestamps on push (ARCHITECTURE §6.4). Amount mismatches never reach here —
 * they are escalated to the user as a conflict.
 */
export function resolveLww<T extends Pick<SyncEnvelope, 'updated_at'>>(
  local: T,
  remote: T,
): T {
  const l = Date.parse(local.updated_at);
  const r = Date.parse(remote.updated_at);
  if (Number.isNaN(l)) return remote;
  if (Number.isNaN(r)) return local;
  return r >= l ? remote : local;
}

/** Deletion is deliberate: a tombstone beats a concurrent edit, whichever is newer. */
export function resolveTombstone<T extends Pick<SyncEnvelope, 'deleted_at' | 'updated_at'>>(
  local: T,
  remote: T,
): T {
  if (local.deleted_at && !remote.deleted_at) return local;
  if (remote.deleted_at && !local.deleted_at) return remote;
  return resolveLww(local, remote);
}
