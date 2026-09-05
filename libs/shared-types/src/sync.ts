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
  /**
   * Money moved between the user's own pockets — setting cash aside for a
   * bill, or taking it back out.
   *
   * Not income and not spending. It must never count as money leaving: saving
   * £90 toward rent and then paying the £650 rent would otherwise charge £740
   * for a £650 bill. The cash ledger skips transfers entirely; pots are built
   * from them.
   */
  is_transfer: z.boolean().default(false),
  pending: z.boolean().default(false),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const categorySchema = syncEnvelopeSchema.extend({
  name: z.string().min(1).max(48),
  icon: z.string().min(1).max(32),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  limit_minor: z.number().int().nonnegative(),
  /**
   * Superseded by `kind`. Kept until every screen reads the new field, then
   * dropped in migration 009 — removing it now would break the running app.
   */
  is_fixed: z.boolean().default(false),

  /**
   * How many pay packets to split this bill across, 1–4.
   *
   * Null means "as many as fit". Capped at the paydays that exist in one bill
   * period, so a monthly earner asking for four gets one — there is only ever
   * one payday before a monthly bill, and pretending otherwise would quarter
   * every demand and leave the bill short on the day it left.
   */
  installments: z.number().int().min(1).max(4).nullable().default(null),

  /*
   * A FLOW refills each cycle (groceries): spend it or carry it forward.
   * A POT fills up until something empties it (rent, savings, a goal).
   *
   * One shape covering three features is deliberate. A bill, a savings target
   * and "£180 for a winter coat" are the same object — an amount, a rate it
   * fills at, and a balance — and treating them as three unrelated things is
   * why none of them composed before.
   */
  kind: z.enum(['flow', 'pot']).default('flow'),
  pot_kind: z.enum(['bill', 'saving', 'goal']).nullable().default(null),
  /**
   * due_day could only ever express a monthly bill. Quarterly water and annual
   * insurance had nowhere to live.
   */
  recurrence: z
    .enum(['weekly', 'fortnightly', 'four_weekly', 'monthly', 'quarterly', 'annual'])
    .nullable().default(null),
  /** A real date this fell due; later dates are stepped from it. */
  anchor_date: z.string().nullable().default(null),
  /** Goals only. Null means no deadline, which the engine reads as no implied rate. */
  target_date: z.string().nullable().default(null),
  /**
   * Already put by before budgeting started. Without it, someone signing up on
   * the 25th is asked to fund a full month's rent in six days.
   */
  opening_minor: z.number().int().nonnegative().default(0),
  /**
   * Day of the month a fixed cost falls due, for the "Coming up" and "Fixed
   * costs" lists. Null for day-to-day categories, which have no due date.
   * 29-31 simply do not occur in shorter months; the UI clamps rather than
   * inventing a date.
   */
  due_day: z.number().int().min(1).max(31).nullable().default(null),
});
export type Category = z.infer<typeof categorySchema>;
export type Recurrence = NonNullable<Category['recurrence']>;

/** The flow/pot fields of a plain day-to-day category, at their defaults. */
type PotShape = Pick<Category,
  'kind' | 'pot_kind' | 'recurrence' | 'anchor_date' | 'target_date' | 'opening_minor'
  | 'installments'>;

export const flowFields = (): PotShape => ({
  kind: 'flow', pot_kind: null, recurrence: null,
  anchor_date: null, target_date: null, opening_minor: 0, installments: null,
});

/**
 * A recurring commitment. `anchorDate` is a real date it fell due — later ones
 * are stepped from it, which is what makes quarterly and annual work at all.
 * `openingMinor` is what was already put by, so a new account is not asked to
 * fund a full month's rent in the six days before it lands.
 */
/**
 * Turn a day-of-month into a real anchor date in the current month.
 *
 * due_day alone cannot express quarterly or annual, and 29-31 do not exist in
 * every month. Clamping to the month's last day keeps the date real, and
 * stepping forward from a real date is what makes every recurrence exact.
 */
export function anchorFromDueDay(dueDay: number | null, now: Date): string {
  const y = now.getFullYear();
  const m = now.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const day = Math.min(Math.max(dueDay ?? 1, 1), last);
  return `${y}-${`${m + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

export const billFields = (
  recurrence: Recurrence, anchorDate: string, openingMinor = 0,
  /** 1–4, or null for "as many paydays as fit". */
  installments: number | null = null,
): PotShape => ({
  kind: 'pot', pot_kind: 'bill', recurrence,
  anchor_date: anchorDate, target_date: null, opening_minor: openingMinor,
  installments,
});

/**
 * A saving goal: a target with no date attached.
 *
 * Treated as a commitment like a bill — money held back before anything is
 * safe to spend — but with `installments` supplying the rate that a due date
 * would otherwise imply.
 */
export const goalFields = (installments: number | null = null): PotShape => ({
  kind: 'pot', pot_kind: 'goal', recurrence: null,
  anchor_date: null, target_date: null, opening_minor: 0, installments,
});

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
