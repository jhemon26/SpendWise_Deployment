/**
 * Environment validation.
 *
 * ARCHITECTURE §9.3 (A05, misconfiguration): the process exits at boot if the
 * environment is wrong. A server that starts with a missing JWT key and fails
 * on the first login is far worse than one that refuses to start — the first
 * is a 3am page, the second is a failed deploy that rolls back on its own.
 */
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    /** Comma-separated list of allowed browser origins. */
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url().optional(),

    /** RS256 keypair for access tokens (§9.1). PEM, not a path. */
    JWT_PRIVATE_KEY: z.string().min(1).optional(),
    JWT_PUBLIC_KEY: z.string().min(1).optional(),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    /** Master key wrapping each user's DEK (§9.3). Never on disk. */
    KEK: z.string().min(32).optional(),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  /**
   * Optional above so `pnpm dev` works on a bare checkout, but production is
   * held to the full set. Getting this backwards — defaults that silently
   * apply in production — is how apps ship with a dev signing key.
   */
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of [
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_PRIVATE_KEY',
      'JWT_PUBLIC_KEY',
      'KEK',
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when NODE_ENV=production`,
        });
      }
    }
    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must be set explicitly in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${detail}`);
  }
  return result.data;
}

/** Boot-time load. Prints the reason and exits non-zero rather than limping on. */
export function loadEnv(): Env {
  try {
    return parseEnv();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error((err as Error).message);
    process.exit(1);
  }
}
