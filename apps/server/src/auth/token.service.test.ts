import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { TokenService, TokenError, hashRefreshToken } from './token.service.js';
import { InMemorySessionStore } from './session.store.js';

let privatePem: string;
let publicPem: string;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
});

const USER = '11111111-1111-4111-8111-111111111111';

let store: InMemorySessionStore;
let clock: Date;
let svc: TokenService;

beforeEach(() => {
  store = new InMemorySessionStore();
  clock = new Date('2026-08-07T10:00:00Z');
  svc = new TokenService(store, privatePem, publicPem, { now: () => clock });
});

const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));

describe('issue', () => {
  it('returns a usable pair', async () => {
    const p = await svc.issue(USER, 'device-1');
    expect(p.access_token.split('.')).toHaveLength(3);
    expect(p.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(p.expires_in).toBe(900);
    expect(p.family_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never stores the refresh token itself', async () => {
    const p = await svc.issue(USER, 'device-1');
    const rows = store.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refresh_hash).toBe(hashRefreshToken(p.refresh_token));
    expect(rows[0]!.refresh_hash).not.toContain(p.refresh_token);
  });

  it('mints a distinct token every time', async () => {
    const a = await svc.issue(USER, 'd1');
    const b = await svc.issue(USER, 'd1');
    expect(a.refresh_token).not.toBe(b.refresh_token);
    expect(a.family_id).not.toBe(b.family_id); // separate sign-ins, separate lineages
  });
});

describe('access token', () => {
  it('verifies and carries the expected claims', async () => {
    const p = await svc.issue(USER, 'd1', ['user', 'support']);
    const claims = await svc.verifyAccess(p.access_token);
    expect(claims.sub).toBe(USER);
    expect(claims.roles).toEqual(['user', 'support']);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('expires after 15 minutes', async () => {
    const p = await svc.issue(USER, 'd1');
    advance(14 * 60_000);
    await expect(svc.verifyAccess(p.access_token)).resolves.toBeDefined();
    advance(2 * 60_000); // now 16 minutes
    await expect(svc.verifyAccess(p.access_token)).rejects.toThrow(TokenError);
  });

  it('rejects a tampered payload', async () => {
    const p = await svc.issue(USER, 'd1');
    const [h, , s] = p.access_token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'attacker', roles: ['admin'] }),
    ).toString('base64url');
    await expect(svc.verifyAccess(`${h}.${forged}.${s}`)).rejects.toThrow(TokenError);
  });

  it('rejects a token signed with a different RSA algorithm', async () => {
    // The `algorithms: ['RS256']` pin exists for this. jose already refuses a
    // symmetric algorithm against an RSA KeyLike, so alg-confusion is blocked
    // by the key type; what the pin adds is refusing RS512/PS256/etc, which
    // are otherwise perfectly valid for this same key. Without the pin this
    // token verifies.
    const key = await importPKCS8(privatePem, 'RS512');
    const iat = Math.floor(clock.getTime() / 1000);
    const token = await new SignJWT({ sid: 'x', roles: ['admin'] })
      .setProtectedHeader({ alg: 'RS512', typ: 'JWT' })
      .setSubject(USER)
      .setJti('00000000-0000-4000-8000-000000000000')
      .setIssuer('https://api.spendwise.app')
      .setAudience('spendwise')
      .setIssuedAt(iat)
      .setExpirationTime(iat + 900)
      .sign(key);

    await expect(svc.verifyAccess(token)).rejects.toThrow(TokenError);
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: USER, roles: ['admin'] })).toString('base64url');
    await expect(svc.verifyAccess(`${header}.${body}.`)).rejects.toThrow(TokenError);
  });

  it('rejects a token signed by a genuinely different key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const attacker = new TokenService(
      new InMemorySessionStore(),
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      { now: () => clock }, // same issuer and audience: only the signature differs
    );
    const forged = await attacker.issue(USER, 'd1');
    await expect(svc.verifyAccess(forged.access_token)).rejects.toThrow(TokenError);
    // and the attacker's own service accepts it, proving the token is otherwise valid
    await expect(attacker.verifyAccess(forged.access_token)).resolves.toBeDefined();
  });

  it('rejects a token whose issuer does not match', async () => {
    const other = new TokenService(new InMemorySessionStore(), privatePem, publicPem, {
      now: () => clock,
      issuer: 'https://evil.example',
    });
    const p = await other.issue(USER, 'd1');
    await expect(svc.verifyAccess(p.access_token)).rejects.toThrow(TokenError);
  });
});

describe('rotate', () => {
  it('returns a new pair and keeps the family', async () => {
    const first = await svc.issue(USER, 'd1');
    advance(60_000);
    const second = await svc.rotate(first.refresh_token);

    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.family_id).toBe(first.family_id);
    await expect(svc.verifyAccess(second.access_token)).resolves.toBeDefined();
  });

  it('makes the old token single-use', async () => {
    const first = await svc.issue(USER, 'd1');
    await svc.rotate(first.refresh_token);
    // second use of the same token is reuse, not merely invalid
    await expect(svc.rotate(first.refresh_token)).rejects.toMatchObject({
      code: 'reuse_detected',
    });
  });

  it('chains across many rotations', async () => {
    let p = await svc.issue(USER, 'd1');
    const family = p.family_id;
    for (let i = 0; i < 10; i++) {
      advance(60_000);
      p = await svc.rotate(p.refresh_token);
      expect(p.family_id).toBe(family);
    }
    expect(await store.countActive(USER)).toBe(1); // exactly one live session
  });

  it('rejects an unknown token', async () => {
    await expect(svc.rotate('not-a-real-token')).rejects.toMatchObject({
      code: 'invalid_refresh',
    });
  });

  it('rejects an expired token', async () => {
    const p = await svc.issue(USER, 'd1');
    advance(31 * 86_400_000);
    await expect(svc.rotate(p.refresh_token)).rejects.toMatchObject({
      code: 'expired_refresh',
    });
  });

  it('reports a replay after expiry as expired, not as reuse', async () => {
    const p = await svc.issue(USER, 'd1');
    advance(31 * 86_400_000);
    await expect(svc.rotate(p.refresh_token)).rejects.toMatchObject({ code: 'expired_refresh' });
    // it was retired on the way out, so a further replay is reuse
    await expect(svc.rotate(p.refresh_token)).rejects.toMatchObject({ code: 'reuse_detected' });
  });
});

describe('reuse detection — the stolen-token scenario', () => {
  it('revokes the whole family when a retired token reappears', async () => {
    // legitimate client signs in and refreshes a few times
    let legit = await svc.issue(USER, 'phone');
    const stolen = legit.refresh_token; // attacker copies this one
    advance(60_000);
    legit = await svc.rotate(legit.refresh_token);
    advance(60_000);
    legit = await svc.rotate(legit.refresh_token);

    expect(await store.countActive(USER)).toBe(1);

    // attacker replays the old token
    await expect(svc.rotate(stolen)).rejects.toMatchObject({ code: 'reuse_detected' });

    // the legitimate client's current token is now dead too — both parties are
    // logged out, which is the correct outcome when we cannot tell them apart
    expect(await store.countActive(USER)).toBe(0);
    await expect(svc.rotate(legit.refresh_token)).rejects.toMatchObject({
      code: 'reuse_detected',
    });
  });

  it('does not touch other families', async () => {
    const phone = await svc.issue(USER, 'phone');
    const laptop = await svc.issue(USER, 'laptop');
    advance(60_000);
    const phone2 = await svc.rotate(phone.refresh_token);

    await expect(svc.rotate(phone.refresh_token)).rejects.toMatchObject({
      code: 'reuse_detected',
    });

    // the laptop session is a separate lineage and must survive
    expect(phone2.family_id).not.toBe(laptop.family_id);
    await expect(svc.rotate(laptop.refresh_token)).resolves.toBeDefined();
  });

  it('treats a concurrent double-refresh as reuse', async () => {
    // Two requests race with the same token: one wins the compare-and-set, the
    // loser must not be handed a valid pair.
    const p = await svc.issue(USER, 'd1');
    const [a, b] = await Promise.allSettled([
      svc.rotate(p.refresh_token),
      svc.rotate(p.refresh_token),
    ]);
    const outcomes = [a.status, b.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
  });
});

describe('revokeFamily', () => {
  it('signs out every session in the lineage', async () => {
    let p = await svc.issue(USER, 'd1');
    advance(60_000);
    p = await svc.rotate(p.refresh_token);

    expect(await svc.revokeFamily(p.family_id)).toBe(1);
    expect(await store.countActive(USER)).toBe(0);
    await expect(svc.rotate(p.refresh_token)).rejects.toMatchObject({
      code: 'reuse_detected',
    });
  });
});
