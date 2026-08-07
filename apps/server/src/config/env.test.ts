import { describe, it, expect } from 'vitest';
import { parseEnv } from './env.js';

const prodBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app:pw@db:5432/spendwise',
  REDIS_URL: 'redis://redis:6379',
  JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----x',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----x',
  KEK: 'x'.repeat(32),
  CORS_ORIGINS: 'https://spendwise.app',
};

describe('parseEnv', () => {
  it('applies development defaults on a bare environment', () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('coerces PORT from a string', () => {
    expect(parseEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => parseEnv({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => parseEnv({ PORT: 'nope' })).toThrow(/PORT/);
  });

  it('splits and trims CORS_ORIGINS', () => {
    expect(parseEnv({ CORS_ORIGINS: 'https://a.com, https://b.com ' }).CORS_ORIGINS).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('accepts a complete production environment', () => {
    expect(parseEnv(prodBase).NODE_ENV).toBe('production');
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'KEK'] as const)(
    'refuses to start in production without %s',
    (key) => {
      const env: Record<string, string> = { ...prodBase };
      delete env[key];
      expect(() => parseEnv(env)).toThrow(new RegExp(key));
    },
  );

  it('refuses to start in production without an explicit CORS allowlist', () => {
    const env: Record<string, string> = { ...prodBase };
    delete env.CORS_ORIGINS;
    expect(() => parseEnv(env)).toThrow(/CORS_ORIGINS/);
  });

  it('does not impose production requirements on development', () => {
    // the whole point: a bare checkout still runs
    expect(() => parseEnv({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => parseEnv({ ...prodBase, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a short KEK', () => {
    expect(() => parseEnv({ ...prodBase, KEK: 'tooshort' })).toThrow(/KEK/);
  });
});
