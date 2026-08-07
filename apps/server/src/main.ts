import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // exits non-zero on a bad environment

  const app = await NestFactory.create(AppModule, {
    logger: env.NODE_ENV === 'production' ? ['error', 'warn', 'log'] : ['debug', 'verbose', 'log', 'warn', 'error'],
  });

  /* Security headers (§9.5). Nginx sets these too; belt and braces, because a
     direct-to-origin request that bypasses the proxy still gets them. */
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], objectSrc: ["'none'"] } },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  /* Deny-by-default CORS: an empty allowlist blocks every browser origin
     rather than falling open to '*'. Native clients are unaffected. */
  app.enableCors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  /* Validation is per-route via ZodValidationPipe, using the same schemas the
     client imports from @spendwise/shared-types (§7.2). Deliberately not
     Nest's global ValidationPipe: that needs class-validator decorators, which
     would mean every DTO defined twice and free to drift. */

  /* Cap request bodies. The sync push batch is capped at 100 records in the
     schema; this is the blunt instrument in front of it. */
  app.use(json({ limit: '2mb' }));

  /* Lets the blue container finish in-flight requests when the deploy script
     drains it, instead of dropping them (§12). */
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  new Logger('bootstrap').log(`SpendWise API listening on :${env.PORT} [${env.NODE_ENV}]`);
}

void bootstrap();
