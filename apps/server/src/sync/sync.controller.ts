import { Body, Controller, Get, Post, Query, Req, UsePipes } from '@nestjs/common';
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
}
