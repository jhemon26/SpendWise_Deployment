import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';

/**
 * Root module.
 *
 * Feature modules land here as they arrive (Phase 3): auth, users, rbac, sync,
 * transactions, categories, files, notifications, audit — see ARCHITECTURE §2.
 */
@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
