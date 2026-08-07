import { Module, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { generateKeyPairSync } from 'node:crypto';
import { HealthController } from './health/health.controller.js';
import { SyncController } from './sync/sync.controller.js';
import { SyncService } from './sync/sync.service.js';
import { InMemorySyncRepo } from './sync/sync.repo.js';
import { TokenService } from './auth/token.service.js';
import { InMemorySessionStore } from './auth/session.store.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthController } from './auth/auth.controller.js';
import { IdentityService } from './auth/identity.service.js';
import { OidcVerifier, GOOGLE, APPLE } from './auth/oidc.verifier.js';
import { OtpService, InMemoryOtpStore } from './auth/otp.service.js';
import { Db } from './db/db.js';
import { loadEnv } from './config/env.js';

/**
 * Root module.
 *
 * Stores are still in-memory: Postgres and Redis wiring is the next task, and
 * the interfaces (SessionStore, SyncRepo) exist precisely so swapping them is
 * a provider change rather than a rewrite of the security-critical logic.
 */
@Module({
  controllers: [HealthController, SyncController, AuthController],
  providers: [
    {
      provide: TokenService,
      useFactory: (): TokenService => {
        const env = loadEnv();
        let priv = env.JWT_PRIVATE_KEY;
        let pub = env.JWT_PUBLIC_KEY;

        if (!priv || !pub) {
          // Development convenience only. The env schema makes both mandatory
          // when NODE_ENV=production, so this branch cannot be reached there —
          // that guard is what stops a throwaway key shipping to users.
          const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
          priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
          pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
          new Logger('TokenService').warn(
            'No JWT keypair configured — generated an ephemeral one. Tokens die on restart.',
          );
        }

        return new TokenService(new InMemorySessionStore(), priv, pub, {
          accessTtlSeconds: 15 * 60,
          refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
        });
      },
    },
    {
      provide: SyncService,
      useFactory: (): SyncService => new SyncService(new InMemorySyncRepo()),
    },
    {
      provide: Db,
      useFactory: (): Db => {
        const env = loadEnv();
        const url = env.DATABASE_URL ?? 'postgres://spendwise_app@127.0.0.1:5432/spendwise';
        return new Db({ connectionString: url });
      },
    },
    { provide: IdentityService, useFactory: (db: Db) => new IdentityService(db), inject: [Db] },
    {
      provide: OidcVerifier,
      useFactory: (): OidcVerifier =>
        new OidcVerifier({
          google: { ...GOOGLE, audience: process.env['GOOGLE_CLIENT_ID'] ?? 'unset' },
          apple: { ...APPLE, audience: process.env['APPLE_CLIENT_ID'] ?? 'app.spendwise.mobile' },
        }),
    },
    {
      provide: OtpService,
      useFactory: (): OtpService =>
        new OtpService(new InMemoryOtpStore(), {
          // Premium-rate ranges commonly abused for SMS pumping (ARCHITECTURE 9.1).
          blockedPrefixes: ['+8811', '+8812', '+8813', '+239', '+676', '+675'],
        }),
    },
    // Deny by default: every route needs a valid bearer token unless it opts out.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
