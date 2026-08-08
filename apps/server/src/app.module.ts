import { Module, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { generateKeyPairSync } from 'node:crypto';
import Redis from 'ioredis';

import { HealthController } from './health/health.controller.js';
import { SyncController } from './sync/sync.controller.js';
import { AuthController } from './auth/auth.controller.js';

import { Db } from './db/db.js';
import { AuditService } from './audit/audit.service.js';
import { TokenService } from './auth/token.service.js';
import { PgSessionStore } from './auth/session.store.pg.js';
import { InMemorySessionStore } from './auth/session.store.js';
import { IdentityService } from './auth/identity.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { OidcVerifier, GOOGLE, APPLE } from './auth/oidc.verifier.js';
import { OtpService, InMemoryOtpStore, type OtpStore } from './auth/otp.service.js';
import { RedisOtpStore } from './auth/otp.store.redis.js';
import { loadEnv } from './config/env.js';

export const REDIS = Symbol('REDIS');

/**
 * Root module.
 *
 * Production wiring is PostgreSQL + Redis. The in-memory implementations remain
 * only as a development fallback when no DATABASE_URL / REDIS_URL is set, and
 * the env schema makes both mandatory under NODE_ENV=production, so the
 * fallback cannot reach users.
 */
@Module({
  controllers: [HealthController, SyncController, AuthController],
  providers: [
    {
      provide: Db,
      useFactory: (): Db => {
        const env = loadEnv();
        const url =
          env.DATABASE_URL ??
          'postgres://spendwise_app:change-me-in-production@127.0.0.1:5432/spendwise';
        if (!env.DATABASE_URL) {
          new Logger('Db').warn('DATABASE_URL unset — using the local development default');
        }
        return new Db({ connectionString: url });
      },
    },

    {
      provide: REDIS,
      useFactory: (): Redis | null => {
        const env = loadEnv();
        if (!env.REDIS_URL) {
          new Logger('Redis').warn('REDIS_URL unset — OTP limits will be in-process only');
          return null;
        }
        return new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
      },
    },

    { provide: AuditService, useFactory: (db: Db) => new AuditService(db), inject: [Db] },
    { provide: IdentityService, useFactory: (db: Db) => new IdentityService(db), inject: [Db] },

    {
      provide: TokenService,
      useFactory: (db: Db): TokenService => {
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

        // Sessions live in Postgres under RLS; only the refresh-token lookup
        // uses the audited bypass from migration 003.
        const store = env.DATABASE_URL ? new PgSessionStore(db) : new InMemorySessionStore();
        return new TokenService(store, priv, pub, {
          accessTtlSeconds: 15 * 60,
          refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
        });
      },
      inject: [Db],
    },

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
      useFactory: (redis: Redis | null): OtpService => {
        const store: OtpStore = redis ? new RedisOtpStore(redis) : new InMemoryOtpStore();
        /**
         * Tunable without a rebuild, because the right numbers are only
         * knowable from real traffic.
         *
         * The per-IP limit is the loose one on purpose. Mobile carriers put
         * thousands of subscribers behind a single CGNAT address, so a tight
         * per-IP cap does not stop an attacker (they rotate addresses) but does
         * lock out everyone on that carrier. The controls that actually matter
         * are per-NUMBER sends, which is what SMS pumping abuses, the daily
         * spend ceiling, and the five-guess attempt limit — and those stay
         * tight.
         */
        const num = (key: string, fallback: number): number => {
          const raw = process.env[key];
          if (raw === undefined) return fallback;
          const n = Number(raw);
          return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
        };

        return new OtpService(store, {
          perTargetPerHour: num('OTP_PER_TARGET_PER_HOUR', 5),
          perIpPerDay: num('OTP_PER_IP_PER_DAY', 60),
          dailySendCeiling: num('OTP_DAILY_CEILING', 5000),
          maxAttempts: num('OTP_MAX_ATTEMPTS', 5),
          // Premium-rate ranges commonly abused for SMS pumping (§9.1).
          blockedPrefixes: ['+8811', '+8812', '+8813', '+239', '+676', '+675'],
        });
      },
      inject: [REDIS],
    },

    // Deny by default: every route needs a valid bearer token unless it opts out.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
