import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { Db } from '../db/db.js';
import { PgSessionStore } from './session.store.pg.js';
import { IdentityService } from './identity.service.js';
import { TokenService } from './token.service.js';

const PGHOST = process.env['PGHOST'] ?? '127.0.0.1';
const PGPORT = Number(process.env['PGPORT'] ?? 55432);
const SUPER = process.env['PGSUPER'] ?? 'postgres';
const DB = 'spendwise_auth_it';
const MIG = join(process.cwd(), 'migrations');

const available: boolean = await (async () => {
  try {
    const c = new Client({ host: PGHOST, port: PGPORT, user: SUPER, database: 'postgres' });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
})();

let db: Db;
let ids: IdentityService;
let tokens: TokenService;

async function sup(database: string): Promise<Client> {
  const c = new Client({ host: PGHOST, port: PGPORT, user: SUPER, database });
  await c.connect();
  c.on('notice', () => undefined);
  return c;
}

beforeAll(async () => {
  if (!available) return;
  const root = await sup('postgres');
  await root.query(`DROP DATABASE IF EXISTS ${DB}`);
  await root.query(`CREATE DATABASE ${DB}`);
  await root.end();

  const c = await sup(DB);
  for (const f of ['001_init.sql', '002_rls.sql', '003_auth_lookups.sql']) {
    await c.query(readFileSync(join(MIG, f), 'utf8'));
  }
  await c.end();

  db = new Db({
    host: PGHOST, port: PGPORT, user: 'spendwise_app',
    password: 'change-me-in-production', database: DB,
  });
  ids = new IdentityService(db);

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  tokens = new TokenService(
    new PgSessionStore(db),
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  );
}, 60_000);

afterAll(async () => {
  if (!available || !db) return;
  await db.close();
  const root = await sup('postgres');
  await root.query(`DROP DATABASE IF EXISTS ${DB}`);
  await root.end();
});

describe.skipIf(!available)('identity + sessions over Postgres', () => {
  beforeEach(async () => {
    const c = await sup(DB);
    await c.query('DELETE FROM sessions');
    await c.query('DELETE FROM identities');
    await c.query('DELETE FROM user_roles');
    await c.query('DELETE FROM users');
    await c.end();
  });

  describe('first sign-in', () => {
    it('creates a user and links the provider identity', async () => {
      const r = await ids.resolve({
        provider: 'google', subject: 'g-1',
        email: 'jahid@example.com', email_verified: true, display_name: 'Jahid',
      });
      expect(r.created).toBe(true);
      expect(r.user_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await ids.find('google', 'g-1')).toBe(r.user_id);
    });

    it('grants the default user role', async () => {
      const r = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      const c = await sup(DB);
      const { rows } = await c.query<{ name: string }>(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
        [r.user_id],
      );
      await c.end();
      expect(rows.map((x) => x.name)).toEqual(['user']);
    });

    it('is idempotent on repeat sign-in', async () => {
      const a = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      const b = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      expect(b.created).toBe(false);
      expect(b.user_id).toBe(a.user_id);
    });
  });

  describe('account linking', () => {
    it('links Google and Apple by VERIFIED email', async () => {
      const g = await ids.resolve({
        provider: 'google', subject: 'g-1', email: 'same@example.com', email_verified: true,
      });
      const a = await ids.resolve({
        provider: 'apple', subject: 'a-1', email: 'same@example.com', email_verified: true,
      });
      expect(a.created).toBe(false);
      expect(a.user_id).toBe(g.user_id); // one human, two providers
    });

    it('REFUSES to link on an unverified email', async () => {
      // Otherwise: register a victim's address with a provider that does not
      // verify, and inherit their account.
      const g = await ids.resolve({
        provider: 'google', subject: 'g-1', email: 'victim@example.com', email_verified: true,
      });
      const attacker = await ids.resolve({
        provider: 'email', subject: 'e-evil', email: 'victim@example.com', email_verified: false,
      });
      expect(attacker.user_id).not.toBe(g.user_id);
      expect(attacker.created).toBe(true);
    });

    it('treats Apple private relay as a separate person when emails differ', async () => {
      const g = await ids.resolve({
        provider: 'google', subject: 'g-1', email: 'real@example.com', email_verified: true,
      });
      const a = await ids.resolve({
        provider: 'apple', subject: 'a-1',
        email: 'abc123@privaterelay.appleid.com', email_verified: true,
      });
      expect(a.user_id).not.toBe(g.user_id); // (provider, subject) is the durable key
    });

    it('will not unlink the last identity', async () => {
      const r = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      const out = await ids.unlink(r.user_id, 'google');
      expect(out).toEqual({ removed: false, reason: 'last_identity' });
      expect(await ids.find('google', 'g-1')).toBe(r.user_id); // still signed in
    });

    it('unlinks once a second identity exists', async () => {
      const r = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      await ids.link(r.user_id, { provider: 'phone', subject: '+447700900000' });
      expect(await ids.unlink(r.user_id, 'google')).toEqual({ removed: true });
      expect(await ids.listForUser(r.user_id)).toHaveLength(1);
    });
  });

  describe('sessions under RLS', () => {
    it('issues and rotates a refresh token', async () => {
      const u = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      const first = await tokens.issue(u.user_id, 'phone');
      const second = await tokens.rotate(first.refresh_token);

      expect(second.family_id).toBe(first.family_id);
      expect(await tokens.verifyAccess(second.access_token)).toMatchObject({ sub: u.user_id });
    });

    it('detects reuse and revokes the family, against the real table', async () => {
      const u = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      const first = await tokens.issue(u.user_id, 'phone');
      const second = await tokens.rotate(first.refresh_token);

      await expect(tokens.rotate(first.refresh_token)).rejects.toMatchObject({
        code: 'reuse_detected',
      });
      // the legitimate client is logged out too — correct when we cannot tell
      // the two apart
      await expect(tokens.rotate(second.refresh_token)).rejects.toMatchObject({
        code: 'reuse_detected',
      });
    });

    it('keeps one active session per lineage after many rotations', async () => {
      const u = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      let p = await tokens.issue(u.user_id, 'phone');
      for (let i = 0; i < 5; i++) p = await tokens.rotate(p.refresh_token);

      const c = await sup(DB);
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL`,
        [u.user_id],
      );
      await c.end();
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it('never stores the refresh token itself', async () => {
      const u = await ids.resolve({ provider: 'google', subject: 'g-1', email_verified: true });
      const p = await tokens.issue(u.user_id, 'phone');
      const c = await sup(DB);
      const { rows } = await c.query<{ refresh_hash: string }>(
        `SELECT refresh_hash FROM sessions WHERE user_id = $1`,
        [u.user_id],
      );
      await c.end();
      expect(rows[0]!.refresh_hash).not.toContain(p.refresh_token);
      expect(rows[0]!.refresh_hash).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
    });

    it('cannot see another user\'s sessions', async () => {
      const a = await ids.resolve({ provider: 'google', subject: 'g-a', email_verified: true });
      const b = await ids.resolve({ provider: 'google', subject: 'g-b', email_verified: true });
      await tokens.issue(a.user_id, 'phone');

      const store = new PgSessionStore(db);
      expect(await store.countActive(b.user_id)).toBe(0);
      expect(await store.countActive(a.user_id)).toBe(1);
    });
  });
});
