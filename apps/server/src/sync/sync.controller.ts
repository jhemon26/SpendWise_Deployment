import { Body, Controller, Get, Post, Put, Query, Req, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import {
  syncPushRequestSchema,
  syncPullQuerySchema,
  type SyncPushRequest,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@spendwise/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { Db } from '../db/db.js';
import { PgSyncRepo } from './sync.repo.pg.js';
import { SyncService } from './sync.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserSettings } from './sync.repo.js';

/** Bounded on every field: this lands in a database and then in a UI. */
const settingsSchema = z.object({
  display_name: z.string().max(48).default(''),
  base_currency: z.string().length(3).default('GBP'),
  day_to_day_minor: z.number().int().nonnegative().max(1_000_000_000).default(0),
  savings_target_minor: z.number().int().nonnegative().max(1_000_000_000).default(0),
  avatar_emoji: z.string().max(32).default(''),
  // Checked here as well as by the column constraint: it is written straight
  // into an inline style on the client.
  avatar_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366F1'),
  monthly_income_minor: z.number().int().nonnegative().max(1_000_000_000).default(0),
});

/**
 * The service is built PER REQUEST, inside `Db.withUser`.
 *
 * It cannot be a singleton: PgSyncRepo holds the transaction-scoped client that
 * carries the RLS context. A shared instance would either hold a stale client
 * or run outside any tenant context, and in the second case every query would
 * quietly return nothing.
 */
@Controller({ path: 'sync', version: '1' })
export class SyncController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * The user id comes from the verified access token, never from the request
   * body. A `user_id` in the payload would be an account-takeover primitive.
   */
  @Post('push')
  @UsePipes(new ZodValidationPipe(syncPushRequestSchema))
  async push(
    @Req() req: AuthedRequest,
    @Body() body: SyncPushRequest,
  ): Promise<SyncPushResponse> {
    const userId = req.user!.id;
    const res = await this.db.withUser(userId, async (c) => {
      const svc = new SyncService(new PgSyncRepo(c));
      return svc.push(userId, body);
    });

    if (!res.replayed) {
      await this.audit.record({
        user_id: userId,
        action: 'sync.push',
        actor_ip: req.ip ?? null,
        meta: {
          accepted: res.accepted.length,
          conflicts: res.conflicts.length,
          device_id: body.device_id,
        },
      });
    }
    return res;
  }

  @Get('pull')
  async pull(
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(syncPullQuerySchema)) q: { since?: string; cursor?: string },
  ): Promise<SyncPullResponse> {
    const userId = req.user!.id;
    return this.db.withUser(userId, async (c) => {
      const svc = new SyncService(new PgSyncRepo(c));
      return svc.pull(userId, q.since ? new Date(q.since) : new Date(0), q.cursor ?? null);
    });
  }
  /**
   * Device-level preferences: name, budgets, avatar.
   *
   * Deliberately NOT part of the sync envelope. These are single scalars with
   * last-write-wins semantics; putting them through the transaction merge
   * machinery — versions, conflicts, idempotency keys — would be ceremony for
   * values that cannot meaningfully conflict.
   */
  @Get('settings')
  async getSettings(@Req() req: AuthedRequest): Promise<{ settings: UserSettings | null }> {
    const userId = req.user!.id;
    const settings = await this.db.withUser(userId, async (c) =>
      new PgSyncRepo(c).getSettings(userId),
    );
    return { settings };
  }

  @Put('settings')
  @UsePipes(new ZodValidationPipe(settingsSchema))
  async putSettings(
    @Req() req: AuthedRequest,
    @Body() body: z.infer<typeof settingsSchema>,
  ): Promise<{ ok: true }> {
    const userId = req.user!.id;
    await this.db.withUser(userId, async (c) => {
      await new PgSyncRepo(c).putSettings(userId, {
        ...body,
        // The client's clock decides ordering between its own writes, but the
        // stored stamp is ours — a device running fast must not be able to pin
        // its settings as permanently newest.
        updated_at: new Date().toISOString(),
      });
    });
    return { ok: true };
  }

}
