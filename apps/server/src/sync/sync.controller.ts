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
import { SyncService } from './sync.service.js';

@Controller({ path: 'sync', version: '1' })
export class SyncController {
  constructor(private readonly sync: SyncService) {}

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
    return this.sync.push(req.user!.id, body);
  }

  @Get('pull')
  async pull(
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(syncPullQuerySchema)) q: { since?: string; cursor?: string },
  ): Promise<SyncPullResponse> {
    return this.sync.pull(
      req.user!.id,
      q.since ? new Date(q.since) : new Date(0),
      q.cursor ?? null,
    );
  }
}
